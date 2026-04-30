import {
  json,
  parseLayoutTabRequest,
  validationErrorResponse,
  ValidationError,
  type Env,
  type LayoutTab,
} from "../_shared";

export const onRequestPut: PagesFunction<Env, "id"> = async ({ env, request, params }) => {
  try {
    const body = await parseLayoutTabRequest(request);

    if (body.id !== params.id) {
      return json({ error: "Route tab id does not match payload id" }, { status: 400 });
    }

    const existing = await env.DB.prepare("SELECT author_id, created_at FROM tabs WHERE id = ?").bind(body.id).first<{ author_id: string | null; created_at: string }>();
    if (existing && existing.author_id && existing.author_id !== body.authorId) {
      return json({ error: "Unauthorized to edit this tab" }, { status: 403 });
    }

    const updatedAt = new Date().toISOString();
    const tab: LayoutTab = {
      ...body,
      createdAt: existing?.created_at ?? updatedAt,
      updatedAt,
    };

    await env.DB.prepare(
      `INSERT INTO tabs (id, name, author_id, layout_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        layout_json = excluded.layout_json,
        updated_at = excluded.updated_at`,
    )
      .bind(tab.id, tab.name, tab.authorId ?? null, JSON.stringify(tab.layout), updatedAt, updatedAt)
      .run();

    return json({ tab });
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
    if (params.id === "tab-default") {
      return json({ error: "The Now tab cannot be deleted" }, { status: 400 });
    }

    const authorId = request.headers.get("X-Author-Id");
    const existing = await env.DB.prepare("SELECT author_id FROM tabs WHERE id = ?").bind(params.id).first<{ author_id: string | null }>();
    if (existing && existing.author_id && existing.author_id !== authorId) {
      return json({ error: "Unauthorized to delete this tab" }, { status: 403 });
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE tabs
         SET cloned_from_tab_id = NULL
         WHERE cloned_from_tab_id = ?`,
      ).bind(params.id),
      env.DB.prepare(
        `DELETE FROM tabs
         WHERE id = ?`,
      ).bind(params.id),
    ]);

    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete tab";
    return json({ error: message }, { status: 400 });
  }
};
