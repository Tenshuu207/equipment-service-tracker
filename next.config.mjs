/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.18.158"],
  // Required for Docker: produces a self-contained server.js + node_modules snapshot
  output: "standalone",

  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },

  // Tell Next.js NOT to try to bundle these native Node packages.
  // pg uses native bindings; pdf-parse has a compiled C extension.
  // Without this they fail to compile inside the Next.js build pipeline.
  serverExternalPackages: ["pg", "pdf-parse"],
}

export default nextConfig
