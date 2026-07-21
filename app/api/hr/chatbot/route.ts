import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { handleChatbotMessage } from '@/lib/hr/chatbot';

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const message = String(body.message ?? '').trim();
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

  const result = await handleChatbotMessage(user.id, message);
  return NextResponse.json(result);
}
