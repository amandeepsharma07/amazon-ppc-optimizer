import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { currentUser } from "@/lib/auth";
import build from "../../../../../assets/extension-build.json";

/**
 * Serves the extension archive to signed-in users only.
 *
 * The file deliberately does not live in `public/`: everything there is served
 * by URL to anyone who knows the path, with no session involved. Reading it
 * through a route handler puts it behind the same account list the Team page
 * manages, so disabling someone's account revokes their download too.
 *
 * `outputFileTracingIncludes` in next.config.ts is what carries `assets/` into
 * the deployed function. The path is built at request time, so nothing in the
 * build can infer the file is needed, and without that config the download
 * would 404 in production while working perfectly on a laptop.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARCHIVE = join(process.cwd(), "assets", "listing-audit-extension.zip");

export async function GET() {
  let user = null;
  try {
    user = await currentUser();
  } catch {
    // An unreachable database has to read as "not signed in". Failing open
    // here would hand the file to anyone the moment the database wobbled.
    user = null;
  }

  if (!user) {
    return new Response("Sign in to download the extension.", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let archive: Buffer;
  try {
    archive = await readFile(ARCHIVE);
  } catch {
    return new Response("The extension archive is missing from this deployment.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(new Uint8Array(archive), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="listing-audit-${build.version}.zip"`,
      "content-length": String(archive.length),
      // Behind a session, so no shared cache may ever hold a copy.
      "cache-control": "private, no-store",
      "x-extension-version": build.version,
    },
  });
}
