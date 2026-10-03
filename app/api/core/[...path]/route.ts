import { assertOrigin, errorResponse, HttpError } from "../../../../lib/auth";
import { core, submitCommand, createReview } from "../../../../lib/core";
async function proxy(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    const joined = path.join("/");
    if (
      !/^(overview|organizations|organizations\/[a-zA-Z0-9_-]+|tasks|alerts|operations|operations\/[a-zA-Z0-9_-]+|reviews|commands)$/.test(
        joined,
      )
    )
      throw new HttpError(404, "接口不存在");
    if (req.method === "POST") {
      assertOrigin(req);
      if (!["reviews", "commands"].includes(joined))
        throw new HttpError(405, "不支持该操作");
    }
    const url = new URL(req.url);
    if (req.method === "POST" && joined === "commands")
      return Response.json(await submitCommand(await req.json()));
    if (req.method === "POST" && joined === "reviews")
      return Response.json(await createReview(await req.json()));
    return Response.json(
      await core(
        `/v2/internal/ops/${joined}${url.search}`,
        req.method,
        req.method === "POST" ? await req.json() : undefined,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = proxy;
export const POST = proxy;
