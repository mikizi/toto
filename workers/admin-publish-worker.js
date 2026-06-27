const DEFAULT_ALLOWED_ORIGIN = "https://mikizi.github.io";
const DEFAULT_REPO = "mikizi/toto";
const DISPATCH_EVENT_TYPE = "update-score";
const RESTORE_EVENT_TYPE = "restore-score";
const BROADCAST_EVENT_TYPE = "update-broadcast";
const REGISTRATION_EVENT_TYPE = "update-registration";
const KNOCKOUT_EVENT_TYPE = "update-knockout";
const XLSX_SYNC_EVENT_TYPE = "sync-xlsx-upload";
const XLSX_REPO_PATH = "xlsx/Master WorldCup26.xlsx";
const XLSX_DOWNLOAD_NAME = "Master WorldCup26.xlsx";
const MAX_XLSX_UPLOAD_BYTES = 30 * 1024 * 1024;
const PRESENCE_TTL_SECONDS = 600;
const PRESENCE_COUNT_CACHE_MS = 60000;
const PRESENCE_KEY_PREFIX = "viewer:";

let presenceCountCache = {
  value: null,
  expiresAt: 0,
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
    const corsHeaders = buildCorsHeaders(origin, allowedOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!isAllowedOrigin(origin, allowedOrigin)) {
      return jsonResponse({ ok: false, error: "Origin not allowed" }, 403, corsHeaders);
    }

    const url = new URL(request.url);
    if (url.pathname === "/presence") {
      return handlePresence(request, env, corsHeaders);
    }

    const allowedPaths = ["/publish", "/restore", "/broadcast", "/registration", "/knockout", "/xlsx"];
    if (!allowedPaths.includes(url.pathname)) {
      return jsonResponse({ ok: false, error: "Not found" }, 404, corsHeaders);
    }

    if (!env.GITHUB_TOKEN || !env.ADMIN_PASSWORD) {
      return jsonResponse({ ok: false, error: "Worker secrets are not configured" }, 500, corsHeaders);
    }

    const password = request.headers.get("X-Admin-Password") || "";
    if (password !== env.ADMIN_PASSWORD) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401, corsHeaders);
    }

    if (url.pathname === "/xlsx") {
      if (request.method === "GET") {
        return downloadWorkbook(env, corsHeaders);
      }
      if (request.method === "POST") {
        return uploadWorkbook(request, env, corsHeaders);
      }
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
    }

    const payload = await readJson(request);
    const repo = env.GITHUB_REPO || DEFAULT_REPO;

    if (url.pathname === "/broadcast") {
      const action = typeof payload.action === "string" ? payload.action : "set";
      const githubResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: githubJsonHeaders(env),
        body: JSON.stringify({
          event_type: BROADCAST_EVENT_TYPE,
          client_payload: {
            action,
            openMatchIds: Array.isArray(payload.openMatchIds) ? payload.openMatchIds : undefined,
            suppressAuto: payload.suppressAuto,
            autoPilot: payload.autoPilot,
          },
        }),
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        return jsonResponse(
          { ok: false, error: `GitHub dispatch failed: ${githubResponse.status} ${errorText}` },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ ok: true, message: "Queued broadcast update" }, 202, corsHeaders);
    }

    if (url.pathname === "/registration") {
      const users = Array.isArray(payload.users)
        ? payload.users.map((name) => String(name).trim()).filter(Boolean)
        : null;
      if (!users) {
        return jsonResponse({ ok: false, error: "users must be a list of names" }, 400, corsHeaders);
      }

      const githubResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: githubJsonHeaders(env),
        body: JSON.stringify({
          event_type: REGISTRATION_EVENT_TYPE,
          client_payload: { users },
        }),
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        return jsonResponse(
          { ok: false, error: `GitHub dispatch failed: ${githubResponse.status} ${errorText}` },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ ok: true, message: "Queued registration update" }, 202, corsHeaders);
    }

    if (url.pathname === "/knockout") {
      const action = typeof payload.action === "string" ? payload.action : "";
      if (!["migrate_scoring", "apply_r32_scoring", "sync_fixtures", "set_eliminated", "lock_fixture", "live_score", "stop_live", "confirm_winner"].includes(action)) {
        return jsonResponse({ ok: false, error: "Invalid knockout action" }, 400, corsHeaders);
      }
      const githubResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: githubJsonHeaders(env),
        body: JSON.stringify({
          event_type: KNOCKOUT_EVENT_TYPE,
          client_payload: {
            action,
            matchId: payload.matchId,
            home: payload.home,
            away: payload.away,
            homeScore: payload.homeScore,
            awayScore: payload.awayScore,
            winner: payload.winner,
            eliminated: payload.eliminated,
          },
        }),
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        return jsonResponse(
          { ok: false, error: `GitHub dispatch failed: ${githubResponse.status} ${errorText}` },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ ok: true, message: "Queued knockout update" }, 202, corsHeaders);
    }

    if (url.pathname === "/restore") {
      const matchId = toNonNegativeInteger(payload.matchId);
      if (matchId === null) {
        return jsonResponse({ ok: false, error: "Invalid matchId" }, 400, corsHeaders);
      }

      const githubResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: githubJsonHeaders(env),
        body: JSON.stringify({
          event_type: RESTORE_EVENT_TYPE,
          client_payload: { matchId },
        }),
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        return jsonResponse(
          { ok: false, error: `GitHub dispatch failed: ${githubResponse.status} ${errorText}` },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ ok: true, message: `Queued match ${matchId} restore` }, 202, corsHeaders);
    }

    const matchId = toNonNegativeInteger(payload.matchId);
    const homeScore = toNonNegativeInteger(payload.homeScore);
    const awayScore = toNonNegativeInteger(payload.awayScore);

    if (matchId === null || homeScore === null || awayScore === null) {
      return jsonResponse({ ok: false, error: "Invalid matchId, homeScore, or awayScore" }, 400, corsHeaders);
    }

    const githubResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: githubJsonHeaders(env),
      body: JSON.stringify({
        event_type: DISPATCH_EVENT_TYPE,
        client_payload: {
          matchId,
          home: homeScore,
          away: awayScore,
        },
      }),
    });

    if (!githubResponse.ok) {
      const errorText = await githubResponse.text();
      return jsonResponse(
        { ok: false, error: `GitHub dispatch failed: ${githubResponse.status} ${errorText}` },
        502,
        corsHeaders
      );
    }

    return jsonResponse(
      {
        ok: true,
        message: `Queued match ${matchId}: ${homeScore}-${awayScore}`,
      },
      202,
      corsHeaders
    );
  },
};

async function uploadWorkbook(request, env, corsHeaders) {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return jsonResponse({ ok: false, error: "Upload is empty" }, 400, corsHeaders);
  }
  if (contentLength > MAX_XLSX_UPLOAD_BYTES) {
    return jsonResponse({ ok: false, error: "Workbook is too large" }, 413, corsHeaders);
  }

  const buffer = await request.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    return jsonResponse({ ok: false, error: "Upload is empty" }, 400, corsHeaders);
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return jsonResponse({ ok: false, error: "Upload must be an .xlsx workbook" }, 400, corsHeaders);
  }

  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const encodedPath = XLSX_REPO_PATH.split("/").map(encodeURIComponent).join("/");
  const metaResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${encodedPath}`, {
    headers: githubJsonHeaders(env),
  });

  if (!metaResponse.ok) {
    const errorText = await metaResponse.text();
    return jsonResponse(
      { ok: false, error: `GitHub file metadata failed: ${metaResponse.status} ${errorText}` },
      metaResponse.status === 404 ? 404 : 502,
      corsHeaders
    );
  }

  const meta = await metaResponse.json();
  const updateResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${encodedPath}`, {
    method: "PUT",
    headers: githubJsonHeaders(env),
    body: JSON.stringify({
      message: "Workbook: upload admin xlsx",
      content: arrayBufferToBase64(buffer),
      sha: meta.sha,
    }),
  });

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    return jsonResponse(
      { ok: false, error: `GitHub workbook upload failed: ${updateResponse.status} ${errorText}` },
      502,
      corsHeaders
    );
  }

  const dispatchResponse = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: githubJsonHeaders(env),
    body: JSON.stringify({
      event_type: XLSX_SYNC_EVENT_TYPE,
      client_payload: {
        path: XLSX_REPO_PATH,
        size: bytes.length,
      },
    }),
  });

  if (!dispatchResponse.ok) {
    const errorText = await dispatchResponse.text();
    return jsonResponse(
      { ok: false, error: `GitHub sync dispatch failed: ${dispatchResponse.status} ${errorText}` },
      502,
      corsHeaders
    );
  }

  return jsonResponse(
    {
      ok: true,
      message: "Workbook uploaded. GitHub Actions is regenerating latest.json.",
    },
    202,
    corsHeaders
  );
}

async function handlePresence(request, env, corsHeaders) {
  if (!env.VIEWER_PRESENCE) {
    return jsonResponse(
      { ok: false, error: "Presence storage is not configured" },
      503,
      corsHeaders
    );
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
  }

  if (request.method === "POST") {
    const payload = await readJson(request);
    const id = sanitizePresenceId(payload.id);
    if (!id) {
      return jsonResponse({ ok: false, error: "Invalid viewer id" }, 400, corsHeaders);
    }
    try {
      await env.VIEWER_PRESENCE.put(`${PRESENCE_KEY_PREFIX}${id}`, "1", {
        expirationTtl: PRESENCE_TTL_SECONDS,
      });
    } catch (err) {
      return presenceStorageErrorResponse(err, corsHeaders);
    }
  }

  let viewers;
  try {
    viewers = await countPresenceKeys(env.VIEWER_PRESENCE);
  } catch (err) {
    return presenceStorageErrorResponse(err, corsHeaders);
  }
  return jsonResponse(
    { ok: true, viewers, ttlSeconds: PRESENCE_TTL_SECONDS },
    200,
    {
      ...corsHeaders,
      "Cache-Control": "no-store",
    }
  );
}

function presenceStorageErrorResponse(err, corsHeaders) {
  const rateLimited = isRateLimitError(err);
  return jsonResponse(
    {
      ok: false,
      error: rateLimited
        ? "Presence storage is rate limited"
        : "Presence storage is temporarily unavailable",
    },
    rateLimited ? 429 : 503,
    {
      ...corsHeaders,
      "Retry-After": rateLimited ? "21600" : "1800",
      "Cache-Control": "no-store",
    }
  );
}

function isRateLimitError(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("daily limit") ||
    message.includes("too many requests")
  );
}

function sanitizePresenceId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9._:-]{8,80}$/.test(id)) {
    return "";
  }
  return id;
}

async function countPresenceKeys(kv) {
  const nowMs = Date.now();
  if (
    typeof presenceCountCache.value === "number" &&
    presenceCountCache.expiresAt > nowMs
  ) {
    return presenceCountCache.value;
  }

  let cursor;
  let count = 0;
  do {
    const page = await kv.list({
      prefix: PRESENCE_KEY_PREFIX,
      cursor,
      limit: 1000,
    });
    count += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  presenceCountCache = {
    value: count,
    expiresAt: nowMs + PRESENCE_COUNT_CACHE_MS,
  };
  return count;
}

async function downloadWorkbook(env, corsHeaders) {
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const encodedPath = XLSX_REPO_PATH.split("/").map(encodeURIComponent).join("/");
  const githubResponse = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodedPath}`,
    {
      headers: githubJsonHeaders(env),
    }
  );

  if (!githubResponse.ok) {
    const errorText = await githubResponse.text();
    return jsonResponse(
      { ok: false, error: `GitHub file fetch failed: ${githubResponse.status} ${errorText}` },
      githubResponse.status === 404 ? 404 : 502,
      corsHeaders
    );
  }

  const fileMeta = await githubResponse.json();
  if (!fileMeta.content || fileMeta.encoding !== "base64") {
    const rawResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${encodedPath}`, {
      headers: {
        ...githubJsonHeaders(env),
        Accept: "application/vnd.github.raw",
      },
    });
    if (rawResponse.ok) {
      return new Response(rawResponse.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${XLSX_DOWNLOAD_NAME}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return jsonResponse({ ok: false, error: "Unexpected GitHub file response" }, 502, corsHeaders);
  }

  const binary = Uint8Array.from(atob(fileMeta.content.replace(/\n/g, "")), (char) => char.charCodeAt(0));
  return new Response(binary, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${XLSX_DOWNLOAD_NAME}"`,
      "Cache-Control": "no-store",
    },
  });
}

function buildCorsHeaders(origin, allowedOrigin) {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password, X-File-Name",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };

  if (isAllowedOrigin(origin, allowedOrigin) && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function isAllowedOrigin(origin, allowedOrigin) {
  return (
    !origin ||
    origin === allowedOrigin ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")
  );
}

function githubJsonHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "wc26-toto-admin-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function toNonNegativeInteger(value) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    return null;
  }
  return numberValue;
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}
