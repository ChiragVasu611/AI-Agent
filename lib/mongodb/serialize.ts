export function serializeDoc<T extends Record<string, any>>(doc: T): any {
  const { _id, __v, ...rest } = doc;
  const out: Record<string, unknown> = { id: String(_id) };
  for (const [key, value] of Object.entries(rest)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (value && typeof value === 'object' && value._bsontype === 'ObjectId') {
      out[key] = String(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
