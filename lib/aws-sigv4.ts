import crypto from "crypto";

const sha256hex = (d: string) => crypto.createHash("sha256").update(d, "utf8").digest("hex");
const hmac = (key: crypto.BinaryLike | Buffer, data: string) =>
  crypto.createHmac("sha256", key).update(data, "utf8").digest();

/**
 * Sign a request with AWS Signature Version 4 and return the auth headers to
 * merge into the request. Used for AWS Bedrock when the user configures an IAM
 * access key + secret (the classic AWS credential pair) instead of a Bedrock
 * API key. No SDK dependency — plain HMAC-SHA256 per the SigV4 spec.
 *
 * The body must be the exact string that will be sent (SigV4 signs its hash).
 */
export function signAwsRequest(opts: {
  method?: string;
  url: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  body: string;
  contentType?: string;
}): Record<string, string> {
  const method = opts.method || "POST";
  const service = opts.service || "bedrock";
  const contentType = opts.contentType || "application/json";
  const u = new URL(opts.url);

  // amzdate = YYYYMMDDTHHMMSSZ ; datestamp = YYYYMMDD
  const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const datestamp = amzdate.slice(0, 8);

  const payloadHash = sha256hex(opts.body);

  const signed: [string, string][] = [
    ["content-type", contentType],
    ["host", u.host],
    ["x-amz-date", amzdate],
  ];
  if (opts.sessionToken) signed.push(["x-amz-security-token", opts.sessionToken]);
  signed.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const canonicalHeaders = signed.map(([k, v]) => `${k}:${v.trim()}\n`).join("");
  const signedHeaders = signed.map(([k]) => k).join(";");
  const canonicalRequest = [
    method,
    u.pathname,
    u.search.slice(1), // canonical query string (empty for the chat endpoint)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const scope = `${datestamp}/${opts.region}/${service}/aws4_request`;
  const stringToSign = [algorithm, amzdate, scope, sha256hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${opts.secretAccessKey}`, datestamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const headers: Record<string, string> = {
    "X-Amz-Date": amzdate,
    Authorization: `${algorithm} Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (opts.sessionToken) headers["X-Amz-Security-Token"] = opts.sessionToken;
  return headers;
}
