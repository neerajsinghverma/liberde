// word-extractor ships no type declarations. Only the surface we use.
declare module "word-extractor" {
  class Document {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(): string;
    getFooters(): string;
  }
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<Document>;
  }
}
