import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // El límite por defecto es 1 MB: de sobra para cualquier form, pero
      // la foto de un producto no entra ahí. La sube el mismo server action
      // que crea/edita el producto, así que este límite es el que manda.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
