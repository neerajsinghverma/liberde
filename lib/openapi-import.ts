// Minimal, dependency-free OpenAPI 3.x (JSON) → HttpTool candidate parser.
// Resolves in-document $refs, flattens JSON request bodies, and detects the
// primary security scheme. YAML / Swagger 2.0 are out of scope for now.

import type { HttpToolAuth, HttpToolParam } from "./types";

export interface ParsedOperation {
  name: string;
  description: string;
  method: string;
  path: string; // raw OpenAPI path, e.g. /users/{id}
  urlTemplate: string; // baseUrl + path with {{param}} placeholders
  params: HttpToolParam[];
}
export interface ParsedSpec {
  title: string;
  baseUrl: string;
  auth: HttpToolAuth; // best-effort primary scheme (no secret value)
  operations: ParsedOperation[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

const sanitizeName = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "op";

const jsonType = (t: unknown): HttpToolParam["type"] => {
  const s = String(t);
  if (s === "integer") return "integer";
  if (s === "number") return "number";
  if (s === "boolean") return "boolean";
  return "string";
};

export function parseOpenApi(spec: unknown): ParsedSpec {
  if (!isObj(spec)) throw new Error("Not a valid OpenAPI document.");
  if (!spec.openapi && !spec.swagger) throw new Error("Missing openapi/swagger version field.");
  if (spec.swagger) throw new Error("Swagger 2.0 isn't supported yet — export an OpenAPI 3.x (JSON) spec.");

  const resolveRef = (node: unknown): unknown => {
    if (!isObj(node)) return node;
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
      let cur: unknown = spec;
      for (const seg of node.$ref.slice(2).split("/")) {
        cur = isObj(cur) ? cur[decodeURIComponent(seg.replace(/~1/g, "/").replace(/~0/g, "~"))] : undefined;
      }
      return resolveRef(cur);
    }
    return node;
  };

  const info = isObj(spec.info) ? spec.info : {};
  const title = String(info.title ?? "Imported API");

  const servers = Array.isArray(spec.servers) ? spec.servers : [];
  let baseUrl = isObj(servers[0]) ? String(servers[0].url ?? "") : "";
  baseUrl = baseUrl.replace(/\/+$/, "");

  // Primary security scheme (first one declared).
  let auth: HttpToolAuth = { type: "none" };
  const comps = isObj(spec.components) ? spec.components : {};
  const schemes = isObj(comps.securitySchemes) ? comps.securitySchemes : {};
  const first = Object.values(schemes)[0];
  if (isObj(first)) {
    const t = String(first.type);
    if (t === "http" && String(first.scheme).toLowerCase() === "bearer") auth = { type: "bearer" };
    else if (t === "http" && String(first.scheme).toLowerCase() === "basic") auth = { type: "basic" };
    else if (t === "apiKey")
      auth = {
        type: "apiKey",
        in: first.in === "query" ? "query" : "header",
        name: String(first.name ?? "X-Api-Key"),
      };
  }

  const operations: ParsedOperation[] = [];
  const paths = isObj(spec.paths) ? spec.paths : {};
  const METHODS = ["get", "post", "put", "patch", "delete"];

  for (const [path, itemRaw] of Object.entries(paths)) {
    const item = resolveRef(itemRaw);
    if (!isObj(item)) continue;
    // Path-level params apply to every operation on the path.
    const pathParams = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const opRaw = item[method];
      if (!isObj(opRaw)) continue;
      const op = opRaw;
      const params: HttpToolParam[] = [];
      const rawParams = [...pathParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      for (const pr of rawParams) {
        const p = resolveRef(pr);
        if (!isObj(p) || !p.name || p.in === "cookie") continue;
        const schema = isObj(p.schema) ? p.schema : {};
        params.push({
          name: String(p.name),
          type: jsonType(schema.type),
          description: p.description ? String(p.description) : undefined,
          required: Boolean(p.required) || p.in === "path",
          location: p.in === "query" ? "query" : p.in === "header" ? "header" : "path",
        });
      }
      // JSON request body → flatten top-level properties into body params.
      const rb = resolveRef(op.requestBody);
      if (isObj(rb) && isObj(rb.content)) {
        const json = resolveRef((rb.content as Obj)["application/json"]);
        const schema = isObj(json) ? resolveRef(json.schema) : undefined;
        if (isObj(schema) && isObj(schema.properties)) {
          const req = Array.isArray(schema.required) ? schema.required.map(String) : [];
          for (const [pname, psRaw] of Object.entries(schema.properties)) {
            const ps = resolveRef(psRaw);
            params.push({
              name: pname,
              type: jsonType(isObj(ps) ? ps.type : "string"),
              description: isObj(ps) && ps.description ? String(ps.description) : undefined,
              required: req.includes(pname),
              location: "body",
            });
          }
        }
      }
      const name = sanitizeName(
        (op.operationId as string) || `${method}_${path.replace(/[/{}]/g, "_")}`
      );
      const description = String(op.summary || op.description || `${method.toUpperCase()} ${path}`).slice(0, 300);
      const urlTemplate = baseUrl + path.replace(/\{([^}]+)\}/g, "{{$1}}");
      operations.push({ name, description, method: method.toUpperCase(), path, urlTemplate, params });
    }
  }
  if (operations.length === 0) throw new Error("No operations found in the spec.");
  return { title, baseUrl, auth, operations };
}
