'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const [inputText, setInputText] = useState('');
  const [parsedDramas, setParsedDramas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  function parseInput(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const results = [];
    const idRegex = /\((\d{10,})\)\s*$/;

    for (const line of lines) {
      const match = line.match(idRegex);
      if (match) {
        const id = match[1];
        const name = line.replace(idRegex, '').trim();
        results.push({ id, name });
      }
    }
    return results;
  }

  function handleInputChange(e) {
    const text = e.target.value;
    setInputText(text);
    setError('');
    if (text.trim()) {
      const parsed = parseInput(text);
      setParsedDramas(parsed);
    } else {
      setParsedDramas([]);
    }
  }

  async function handleSubmit() {
    if (parsedDramas.length === 0) {
      setError('未能解析出任何短剧ID，请检查输入格式');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      router.push(`/task/${data.taskId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">新建检测任务</h1>
      <p className="page-subtitle">
        粘贴短剧列表，系统将自动查询后台并在 Google 搜索盗版内容
      </p>

      <div className="card" style={{ maxWidth: 800 }}>
        <label className="input-label" htmlFor="drama-input">
          短剧列表
        </label>
        <textarea
          id="drama-input"
          className="textarea"
          placeholder={`请粘贴短剧列表，每行一条，格式如：\nGoodbye, My Dad's Best Friend(42000007456)\n天降爸妈是大佬（英语配音版）(42000004910)\nRun into the CEO's Secret Playroom(42000004952)`}
          value={inputText}
          onChange={handleInputChange}
          rows={12}
        />

        {parsedDramas.length > 0 && (
          <div className="parse-preview animate-fade-in">
            <div className="preview-header">
              ✅ 解析结果
              <span className="preview-count">{parsedDramas.length} 部短剧</span>
            </div>
            <div className="preview-list">
              {parsedDramas.slice(0, 10).map((d, i) => (
                <div key={i} className="preview-item">
                  <span className="item-id">{d.id}</span>
                  <span>{d.name}</span>
                </div>
              ))}
              {parsedDramas.length > 10 && (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  ... 还有 {parsedDramas.length - 10} 部
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--danger)', marginTop: 16, fontSize: 14 }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleSubmit}
            disabled={loading || parsedDramas.length === 0}
          >
            {loading ? '创建中...' : `🚀 开始检测 (${parsedDramas.length} 部)`}
          </button>
          <button
            className="btn btn-ghost btn-lg"
            onClick={() => { setInputText(''); setParsedDramas([]); setError(''); }}
            disabled={!inputText}
          >
            清空
          </button>
        </div>
      </div>
    </div>
  );
}
