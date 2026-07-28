import type { DeviceProfile, Finding } from './types';
import { dumpLogcat, setWifi, setMobileData, dumpHierarchy } from './device';
import { parseHierarchy, visibleText } from './ui-parser';
import { waitForStableUi } from './smart-wait';

/**
 * Network behaviour analysis.
 *
 * Two independent sources of truth are used, both real:
 *  1. logcat — HTTP/SSL/timeout errors emitted by the app's networking stack.
 *  2. An actual offline transition, to verify the app degrades gracefully.
 *
 * The offline test is SKIPPED when adb itself is attached over Wi-Fi, because
 * disabling the radio would sever the debugging connection. That limitation is
 * reported honestly instead of being silently ignored.
 */

const HTTP_ERROR = /HTTP\/\d\.\d"?\s+(4\d{2}|5\d{2})|responseCode=(4\d{2}|5\d{2})|status(?:Code)?[=:]\s*(4\d{2}|5\d{2})/i;
const TIMEOUT = /SocketTimeoutException|ConnectTimeoutException|timeout(?: exceeded)?|ETIMEDOUT/i;
const SSL_ERROR = /SSLHandshakeException|SSLPeerUnverifiedException|CertPathValidatorException|javax\.net\.ssl|Trust anchor for certification path not found/i;
const DNS_ERROR = /UnknownHostException|EAI_NODATA|No address associated with hostname/i;
const CLEARTEXT = /Cleartext HTTP traffic to ([\w.\-]+) not permitted/i;

export interface NetworkSignals {
  httpErrors: string[];
  timeouts: string[];
  sslErrors: string[];
  dnsErrors: string[];
  cleartextBlocks: string[];
}

export function parseNetworkSignals(log: string, pkg: string): NetworkSignals {
  const relevant = log
    .split('\n')
    .filter((l) => !pkg || l.includes(pkg) || /okhttp|Volley|retrofit|HttpURLConnection|System\.err|SSL|chromium/i.test(l));

  const grab = (re: RegExp) =>
    Array.from(new Set(relevant.filter((l) => re.test(l)).map((l) => l.trim().slice(0, 300)))).slice(0, 8);

  return {
    httpErrors: grab(HTTP_ERROR),
    timeouts: grab(TIMEOUT),
    sslErrors: grab(SSL_ERROR),
    dnsErrors: grab(DNS_ERROR),
    cleartextBlocks: grab(CLEARTEXT),
  };
}

/** Words an app shows when it correctly reports being offline. */
const OFFLINE_COPY = /\b(no internet|no connection|offline|check your (internet|connection|network)|network error|connection (lost|failed|error)|unable to connect|try again)\b/i;

export interface NetworkReport {
  signals: NetworkSignals;
  offlineTested: boolean;
  offlineHandledGracefully: boolean | null;
  findings: Finding[];
  notes: string[];
}

export async function analyzeNetwork(
  serial: string,
  pkg: string,
  profile: DeviceProfile,
  moduleLabel: string,
  screenName: string,
  opts: { testOffline: boolean },
): Promise<NetworkReport> {
  const findings: Finding[] = [];
  const notes: string[] = [];

  // ---- 1. Passive: what the network stack already reported to logcat.
  const log = await dumpLogcat(serial);
  const signals = parseNetworkSignals(log, pkg);

  if (signals.httpErrors.length > 0) {
    findings.push({
      type: 'network',
      module: moduleLabel,
      severity: 'high',
      title: `${signals.httpErrors.length} failing HTTP response(s) observed`,
      description: 'The app received 4xx/5xx responses from its backend while being exercised.',
      screenName,
      activity: '',
      stepsToReproduce: ['Launch and navigate the app', 'Run: adb logcat -d | grep -Ei "http|okhttp"'],
      expectedResult: 'API calls made during normal navigation return successful status codes.',
      actualResult: `Error responses observed:\n${signals.httpErrors.slice(0, 3).join('\n')}`,
      evidence: signals.httpErrors.join('\n').slice(0, 3000),
      rootCause: 'A backend endpoint returned a client or server error — a broken contract, an expired token, or an unavailable service.',
      suggestedFix: 'Inspect the failing endpoints server-side, add explicit error handling and retry/backoff on the client, and surface a user-facing message instead of failing silently.',
    });
  }

  if (signals.sslErrors.length > 0) {
    findings.push({
      type: 'security',
      module: moduleLabel,
      severity: 'critical',
      title: 'TLS/SSL handshake failures detected',
      description: 'The app encountered SSL errors while establishing secure connections.',
      screenName,
      activity: '',
      stepsToReproduce: ['Launch the app', 'Run: adb logcat -d | grep -i ssl'],
      expectedResult: 'All TLS handshakes complete against valid certificate chains.',
      actualResult: signals.sslErrors.slice(0, 3).join('\n'),
      evidence: signals.sslErrors.join('\n').slice(0, 3000),
      rootCause: 'An untrusted/expired certificate, a misconfigured chain, or an overly strict/broken pinning configuration.',
      suggestedFix: 'Verify the server certificate chain, keep pinning configuration current with a backup pin, and never disable certificate validation as a workaround.',
    });
  }

  if (signals.cleartextBlocks.length > 0) {
    findings.push({
      type: 'security',
      module: moduleLabel,
      severity: 'high',
      title: 'App attempted cleartext HTTP traffic',
      description: 'The platform blocked plaintext HTTP requests, meaning the app is still configured to call non-HTTPS endpoints.',
      screenName,
      activity: '',
      stepsToReproduce: ['Launch the app', 'Run: adb logcat -d | grep -i cleartext'],
      expectedResult: 'All traffic uses HTTPS.',
      actualResult: signals.cleartextBlocks.slice(0, 3).join('\n'),
      evidence: signals.cleartextBlocks.join('\n').slice(0, 2000),
      rootCause: 'An endpoint is configured with an http:// scheme, or a network-security-config permits cleartext.',
      suggestedFix: 'Migrate all endpoints to HTTPS and remove cleartextTrafficPermitted exceptions from network_security_config.xml.',
    });
  }

  if (signals.timeouts.length > 2) {
    findings.push({
      type: 'network',
      module: moduleLabel,
      severity: 'medium',
      title: `${signals.timeouts.length} network timeout(s) observed`,
      description: 'Repeated socket/connect timeouts occurred during the session.',
      screenName,
      activity: '',
      stepsToReproduce: ['Navigate the app', 'Run: adb logcat -d | grep -i timeout'],
      expectedResult: 'Requests complete within their configured timeout under normal conditions.',
      actualResult: signals.timeouts.slice(0, 3).join('\n'),
      evidence: signals.timeouts.join('\n').slice(0, 2500),
      rootCause: 'Slow or unreachable endpoints, or timeouts configured too aggressively for real-world latency.',
      suggestedFix: 'Add retry with exponential backoff, tune timeouts, and show a retry affordance rather than an indefinite spinner.',
    });
  }

  // ---- 2. Active: verify graceful offline behaviour.
  let offlineTested = false;
  let offlineHandledGracefully: boolean | null = null;

  if (!opts.testOffline) {
    notes.push('Offline behaviour test not requested.');
  } else if (profile.wireless) {
    // Disabling the radio would kill the adb transport itself.
    notes.push('Offline test skipped: adb is attached over Wi-Fi, so disabling the radio would disconnect the device. Connect over USB to include this check.');
  } else {
    offlineTested = true;
    try {
      await setWifi(serial, false);
      await setMobileData(serial, false);
      await waitForStableUi(serial, { timeoutMs: 6_000 });

      const xml = await dumpHierarchy(serial);
      const text = xml ? visibleText(parseHierarchy(xml).nodes) : '';
      const showsMessage = OFFLINE_COPY.test(text);
      offlineHandledGracefully = showsMessage;

      // A crash while offline is caught by the crash monitor; here we only
      // judge whether the app told the user anything.
      if (!showsMessage) {
        findings.push({
          type: 'network',
          module: moduleLabel,
          severity: 'medium',
          title: 'No offline feedback shown when connectivity is lost',
          description: 'With both Wi-Fi and mobile data disabled, the app did not display any recognisable offline or connection-error message.',
          screenName,
          activity: '',
          stepsToReproduce: [
            'Run: adb shell svc wifi disable && adb shell svc data disable',
            'Interact with a screen that loads remote content',
            'Observe whether the app communicates the connectivity loss',
          ],
          expectedResult: 'The app tells the user it is offline and offers a retry.',
          actualResult: 'No offline/error messaging was present in the UI hierarchy while fully disconnected.',
          evidence: `Visible text while offline:\n${text.slice(0, 1200) || '(no text captured)'}`,
          rootCause: 'Network failures are swallowed without updating UI state, leaving the user with a blank view or an endless spinner.',
          suggestedFix: 'Observe connectivity with NetworkCallback, surface an explicit offline state with a retry action, and cache last-known content where possible.',
        });
      }
    } finally {
      // Always restore connectivity, even if a check threw.
      await setWifi(serial, true);
      await setMobileData(serial, true);
      await waitForStableUi(serial, { timeoutMs: 8_000 });
      notes.push('Connectivity restored after the offline check.');
    }
  }

  return { signals, offlineTested, offlineHandledGracefully, findings, notes };
}
