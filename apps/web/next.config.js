/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ai-zayavki/shared"],
  async rewrites() {
    // API_PROXY_TARGET — только для локальной проверки страницы на живых
    // данных: браузер ходит на /api того же origin, а Next сам пересылает
    // запрос на прод, минуя CORS (он пускает только kerektap.kz). В проде
    // переменная не задана, и всё работает как раньше.
    const target = process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${target}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
