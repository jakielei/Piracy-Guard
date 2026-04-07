import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: '短剧盗版检测工具',
  description: '自动化短剧盗版内容检测与记录',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-container">
          <nav className="navbar">
            <Link href="/" className="navbar-brand">
              <span className="logo">🛡️</span>
              <div>
                <h1>Piracy Detection Tool</h1>
                <span>短剧盗版检测工具</span>
              </div>
            </Link>
          </nav>
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
