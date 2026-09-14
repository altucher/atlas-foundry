import { NextResponse } from 'next/server';

import { adminCookieName } from '@/app/analytics';

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL('/analytics', request.url), 303);
  response.cookies.set(adminCookieName, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
