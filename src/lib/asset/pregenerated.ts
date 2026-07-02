import fs from "node:fs";
import path from "node:path";
import {
  findPregenAsset,
  pregenAssetUrl,
  type PregenAssetKind,
  type PregenAssetSpec,
} from "./pregen-catalog";

export type ResolvedPregenAsset = {
  spec: PregenAssetSpec;
  url: string;
};

export function resolvePregeneratedAsset(opts: {
  kind: PregenAssetKind;
  name?: string | null;
  role?: string | null;
  description?: string | null;
  excludeSlugs?: readonly string[];
  requireFile?: boolean;
}): ResolvedPregenAsset | null {
  const spec = findPregenAsset(opts.kind, opts);
  if (!spec) return null;

  const url = pregenAssetUrl(spec);
  if (opts.requireFile !== false && !publicAssetExists(url)) return null;
  return { spec, url };
}

function publicAssetExists(url: string): boolean {
  const publicRelative = url.replace(/^\//, "");
  return fs.existsSync(path.join(process.cwd(), "public", publicRelative));
}
