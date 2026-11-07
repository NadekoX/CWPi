import { Type } from "typebox";

/** API 错误的统一响应结构。 */
export const ApiErrorVoSchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
});
