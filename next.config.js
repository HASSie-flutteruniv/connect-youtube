/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { 
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'yt3.ggpht.com',
        pathname: '**',
      },
    ],
  },
  // APIルートが静的に生成されないようにする設定
  experimental: {
    // App Routerのサーバーサイドレンダリングを強制
    appDir: true,
    // 静的最適化を無効化
    disableOptimizedLoading: true,
  },
};

module.exports = nextConfig;
