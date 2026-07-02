const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="10" fill="#16120c"/>
  <path d="M12 14h40l-5 36H17L12 14Z" fill="#2a2116" stroke="#c39a4e" stroke-width="4" stroke-linejoin="round"/>
  <path d="M22 25h20M21 34h22M24 43h16" stroke="#e8dcc0" stroke-width="4" stroke-linecap="round"/>
</svg>`;

export const dynamic = "force-static";

export function GET() {
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
