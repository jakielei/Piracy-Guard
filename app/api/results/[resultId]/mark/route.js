import { NextResponse } from 'next/server';

export async function PATCH(request, { params }) {
  try {
    const db = require('@/lib/db');
    const { resultId } = await params;
    const { isPirated } = await request.json();

    db.markPirated(Number(resultId), isPirated);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
