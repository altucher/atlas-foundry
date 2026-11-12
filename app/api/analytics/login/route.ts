import { NextResponse } from 'next/server';

import { adminCookieName, expectedAdminCookie, validAdminPassword } from '@/app/analytics';
import { withBase } from '../../../base-path';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  if (!validAdminPassword(password)) {
    return NextResponse.redirect(new URL(withBase('/analytics?error=1'), request.url), 303);
  }
  const response = NextResponse.redirect(new URL(withBase('/analytics'), request.url), 303);
  response.cookies.set(adminCookieName, expectedAdminCookie(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}
