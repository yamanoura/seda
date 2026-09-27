export class DefinitionError extends Error {}
export class DatabaseError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class ActionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
