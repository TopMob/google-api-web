import type { NextConfig } from "next";

const gatewayUrl = process.env.GATEWAY_URL || "http://127.0.0.1:8081";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: `${gatewayUrl}/v1/:path*`
      },
      {
        source: "/chat/completions",
        destination: `${gatewayUrl}/v1/chat/completions`
      },
      {
        source: "/models",
        destination: `${gatewayUrl}/v1/models`
      },
      {
        source: "/responses",
        destination: `${gatewayUrl}/v1/responses`
      }
    ];
  }
};

export default nextConfig;
