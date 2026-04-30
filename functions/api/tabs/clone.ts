import {
  json,
  parseLayoutTabRequest,
  validationErrorResponse,
  ValidationError,
  type Env,
  type LayoutTab,
} from "../_shared";

const TAB_LIMIT = 20;

type CloneBody = {
  tab: LayoutTab;
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  try {
    const body: CloneBody = {
      tab: await parseLayoutTabRequest(request, { root: "tab" }),
    };

    // Enforce per-author tab limit
    const authorId = body.tab.authorId ?? null;
    if (authorId) {
      const countRow = await env.DB
        .prepare(`SELECT COUNT(*) AS cnt FROM tabs WHERE author_id = ?`)
        .bind(authorId)
        .first<{ cnt: number }>();

      if ((countRow?.cnt ?? 0) >= TAB_LIMIT) {
        return json(
          { error: `tab limit reached (${TAB_LIMIT} max per user)` },
          { status: 429 },
        );
      }
    }

    const updatedAt = new Date().toISOString();
    const tab: LayoutTab = {
      ...body.tab,
      createdAt: updatedAt,
      updatedAt,
    };

    await env.DB.prepare(
      `INSERT INTO tabs
        (id, name, author_id, cloned_from_tab_id, layout_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(tab.id, tab.name, tab.authorId ?? null, tab.clonedFromId ?? null, JSON.stringify(tab.layout), updatedAt, updatedAt)
      .run();

    return json({ tab });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }

    const message = error instanceof Error ? error.message : "Unable to clone tab";
    return json({ error: message }, { status: 400 });
  }
};
