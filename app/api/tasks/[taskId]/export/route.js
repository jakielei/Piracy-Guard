import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const db = require('@/lib/db');
    const XLSX = require('xlsx');
    const { taskId } = await params;
    const { searchParams } = new URL(request.url);
    const operatorName = searchParams.get('operator') || '';

    const piratedResults = db.getPiratedResults(Number(taskId));

    if (piratedResults.length === 0) {
      return NextResponse.json({ error: '没有标记为盗版的记录' }, { status: 400 });
    }

    // Deduplicate by drama_id and url
    const uniqueMap = new Map();
    for (const r of piratedResults) {
      const key = `${r.drama_id}|${r.url}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, r);
      }
    }
    const uniqueResults = Array.from(uniqueMap.values());

    // Build Excel data
    const now = new Date();
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日`;
    // Safe filename string with only ASCII chars
    const safeDateStr = `${now.getMonth() + 1}_${now.getDate()}`;

    const rows = uniqueResults.map(r => {
      // Remove .com, .net, etc. (e.g. from youtube.com -> youtube)
      const platformName = r.domain ? r.domain.replace(/\.[a-z]+$/i, '') : '';
      
      return {
        '日期': dateStr,
        '盗版平台': capitalize(platformName),
        '剧集id': r.drama_id,
        '剧名': r.name || '',
        '中文剧名': r.chinese_name || '',
        '剧集CP': r.cp_name || '',
        '侵权链接': r.url,
        '完成人姓名': operatorName,
        '国内翻译or海外自制': r.content_type || '',
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Set column widths
    ws['!cols'] = [
      { wch: 10 },  // 日期
      { wch: 15 },  // 盗版平台
      { wch: 15 },  // 剧集id
      { wch: 40 },  // 剧名
      { wch: 25 },  // 中文剧名
      { wch: 20 },  // 剧集CP
      { wch: 60 },  // 侵权链接
      { wch: 12 },  // 完成人姓名
      { wch: 20 },  // 国内翻译or海外自制
    ];

    XLSX.utils.book_append_sheet(wb, ws, '盗版检测结果');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="piracy_report_${safeDateStr}.xlsx"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
