import {
  json,
  publicLayoutTab,
  readAuthorIdHeader,
  readLayoutTab,
  readTabCreationLimit,
  parseLayoutTabRequest,
  STATIC_NOW_TAB_ID,
  STATIC_NOW_TAB_NAME,
  tabCreationLimitResponse,
  validationErrorResponse,
  ValidationError,
  type Env,
  type LayoutTab,
  type TabRow,
} from "../_shared";

export const onRequestGet: PagesFunction<Env, "id"> = async ({ env, request, params }) => {
  const authorId = readAuthorIdHeader(request);
  const row = await env.DB.prepare(
    `SELECT
      tabs.id,
      tabs.name,
      CASE
        WHEN tabs.author_id IS NOT NULL AND tabs.author_id = ? THEN 1
        ELSE 0
      END AS can_edit,
      NULL AS cloned_from_tab_id,
      NULL AS cloned_from_tab_name,
      tabs.layout_json,
      tabs.created_at,
      tabs.updated_at
    FROM tabs
    WHERE tabs.id = ?`,
  )
    .bind(authorId, params.id)
    .first<TabRow>();

  if (!row) {
    return json({ error: "Tab not found" }, { status: 404 });
  }

  return json({ tab: publicLayoutTab(readLayoutTab(row)) });
};

export const onRequestPut: PagesFunction<Env, "id"> = async ({ env, request, params }) => {
  try {
    const body = await parseLayoutTabRequest(request);
    const authorId = readAuthorIdHeader(request);
    if (!authorId) {
      return json({ error: "Missing author id" }, { status: 400 });
    }

    if (body.id !== params.id) {
      return json({ error: "Route tab id does not match payload id" }, { status: 400 });
    }

    if (params.id === STATIC_NOW_TAB_ID || body.id === STATIC_NOW_TAB_ID || body.name === STATIC_NOW_TAB_NAME) {
      return json({ error: "The Now tab is static and cannot be saved" }, { status: 400 });
    }

    const layoutJson = JSON.stringify(body.layout);
    const existing = await env.DB.prepare("SELECT author_id, name, layout_json, created_at, updated_at FROM tabs WHERE id = ?").bind(body.id).first<{
      author_id: string | null;
      name: string;
      layout_json: string;
      created_at: string;
      updated_at: string;
    }>();
    if (existing && existing.author_id && existing.author_id !== authorId) {
      return json({ error: "Unauthorized to edit this tab" }, { status: 403 });
    }

    if (!existing) {
      const creationLimit = await readTabCreationLimit(env.DB, authorId);
      if (creationLimit) {
        return tabCreationLimitResponse(creationLimit);
      }
    }

    const updatedAt = new Date().toISOString();
    const tab: LayoutTab = {
      ...body,
      authorId: existing ? existing.author_id : authorId,
      canEdit: !existing || existing.author_id === authorId,
      clonedFromId: null,
      clonedFromName: null,
      createdAt: existing?.created_at ?? updatedAt,
      updatedAt,
    };

    if (existing && existing.name === body.name && existing.layout_json === layoutJson) {
      return json({
        tab: publicLayoutTab({
          ...tab,
          createdAt: existing.created_at,
          updatedAt: existing.updated_at,
        }),
      });
    }

    await env.DB.prepare(
      `INSERT INTO tabs (id, name, author_id, layout_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        layout_json = excluded.layout_json,
        updated_at = excluded.updated_at`,
    )
      .bind(tab.id, tab.name, tab.authorId ?? null, layoutJson, tab.createdAt ?? updatedAt, updatedAt)
      .run();

    return json({ tab: publicLayoutTab(tab) });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }

    const message = error instanceof Error ? error.message : "Unable to save tab";
    return json({ error: message }, { status: 400 });
  }
};

export const onRequestDelete: PagesFunction<Env, "id"> = async ({ env, request, params }) => {
  try {
    if (params.id === STATIC_NOW_TAB_ID) {
      return json({ error: "The Now tab cannot be deleted" }, { status: 400 });
    }

    const authorId = readAuthorIdHeader(request);
    if (!authorId) {
      return json({ error: "Missing author id" }, { status: 400 });
    }

    const existing = await env.DB.prepare("SELECT author_id FROM tabs WHERE id = ?").bind(params.id).first<{ author_id: string | null }>();
    if (existing && existing.author_id && existing.author_id !== authorId) {
      return json({ error: "Unauthorized to delete this tab" }, { status: 403 });
    }

    await env.DB.prepare(
      `DELETE FROM tabs
       WHERE id = ?`,
    ).bind(params.id).run();

    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete tab";
    return json({ error: message }, { status: 400 });
  }
};
