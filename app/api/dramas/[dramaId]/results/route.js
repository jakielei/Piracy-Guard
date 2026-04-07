import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const db = require('@/lib/db');
    const { dramaId } = await params;
    const results = db.getSearchResults(Number(dramaId));
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
