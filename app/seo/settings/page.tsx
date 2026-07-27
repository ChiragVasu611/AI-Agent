import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';
import { SettingsForm } from '@/components/seo/settings-form';

export default async function SeoSettingsPage() {
  const user = await getCurrentUser();
  await connectToDatabase();

  const dbUser = await User.findById(user?.id).lean<any>();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">SEO/ASO Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Defaults, notifications, and an optional AI provider. Every feature in this workspace works fully without an API key —
          adding one only upgrades the AI Project Analysis, Keyword Engine, and Content Engine from deterministic rule-based
          generation to model-generated output.
        </p>
      </div>
      <SettingsForm
        initial={{
          defaultCountry: dbUser?.seoSettings?.defaultCountry ?? 'United States',
          defaultLanguage: dbUser?.seoSettings?.defaultLanguage ?? 'English',
          defaultProjectType: dbUser?.seoSettings?.defaultProjectType ?? 'website',
          defaultReportFormat: dbUser?.seoSettings?.defaultReportFormat ?? 'pdf',
          notifyOnAuditComplete: dbUser?.seoSettings?.notifyOnAuditComplete ?? true,
          notifyOnReportGenerated: dbUser?.seoSettings?.notifyOnReportGenerated ?? true,
          notifyOnCriticalIssue: dbUser?.seoSettings?.notifyOnCriticalIssue ?? true,
          notifyOnOptimizationComplete: dbUser?.seoSettings?.notifyOnOptimizationComplete ?? true,
          notifyOnProjectUpdated: dbUser?.seoSettings?.notifyOnProjectUpdated ?? false,
          seoAiEnabled: dbUser?.seoAiEnabled ?? true,
          hasApiKey: !!dbUser?.seoOpenRouterApiKey,
        }}
      />
    </div>
  );
}
