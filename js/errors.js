import { ERROR } from "./config.js";

const KNOWN = new Set(Object.values(ERROR));

export class AppError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.code = KNOWN.has(code) ? code : ERROR.SERVER;
    this.detail = detail;
  }
}
