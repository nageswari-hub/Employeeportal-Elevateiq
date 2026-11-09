import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AuthProvider } from '../lib/auth-context';
import { AvatarProvider } from '../components/AvatarProvider';
import { AttendanceProvider } from '../components/AttendanceProvider';
import { Shell } from '../components/Shell';

const poppins = localFont({
  src: [
    { path: './fonts/Poppins-Regular.ttf', weight: '400' },
    { path: './fonts/Poppins-Medium.ttf', weight: '500' },
    { path: './fonts/Poppins-SemiBold.ttf', weight: '600' },
    { path: './fonts/Poppins-Bold.ttf', weight: '700' },
  ],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TeamFlow · ElevateIQ',
  description: 'Private internal work OS',
  icons: { icon: '/logo.png', apple: '/logo.png' },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'TeamFlow', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: '#0B2447', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg">Skip to content</a>
        <script dangerouslySetInnerHTML={{ __html: "if('serviceWorker' in navigator && location.protocol==='https:'){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}" }} />
        <AuthProvider>
          <AvatarProvider>
          <AttendanceProvider>
            <Shell>{children}</Shell>
          </AttendanceProvider>
        </AvatarProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
