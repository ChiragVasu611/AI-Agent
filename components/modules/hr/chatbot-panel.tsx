'use client';

import { useRef, useState } from 'react';
import { Bot, Loader2, MessageSquare, Send, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
}

const SUGGESTIONS = [
  "Show today's interviews",
  'Show pending candidates',
  'Who has highest AI score?',
  'Summarize today\'s recruitment activity',
];

export function ChatbotPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'bot', text: "Hi, I'm your HR Copilot. Ask me about interviews, candidates, or say \"generate offer letter for <name>\"." },
  ]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setInput('');
    setPending(true);
    try {
      const res = await fetch('/api/hr/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: 'bot', text: data.reply ?? data.error ?? 'Something went wrong.' }]);
    } catch {
      setMessages((m) => [...m, { role: 'bot', text: 'Failed to reach the HR Copilot. Please try again.' }]);
    } finally {
      setPending(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
    }
  }

  return (
    <>
      <motion.button
        onClick={() => setOpen((o) => !o)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg"
      >
        {open ? <X className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-6 z-40 flex h-[520px] w-96 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl backdrop-blur"
          >
            <div className="flex items-center gap-2 border-b border-border bg-card/80 px-4 py-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">HR Copilot</div>
                <div className="text-[11px] text-muted-foreground">Rule-based, on-device assistant</div>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((m, i) => (
                <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed',
                      m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground',
                    )}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {pending && (
                <div className="flex justify-start">
                  <div className="rounded-xl bg-secondary px-3 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>

            {messages.length <= 1 && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              className="flex items-center gap-2 border-t border-border p-3"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the HR Copilot…"
                className="h-9 flex-1 text-xs"
              />
              <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={pending}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
