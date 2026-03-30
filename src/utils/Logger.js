export class Logger {
  constructor(context) {
    this.context = context;
  }

  _format(level, message, data) {
    const timestamp = new Date().toISOString();
    const base = `[${timestamp}] [${level}] [${this.context}] ${message}`;
    return data ? `${base} ${JSON.stringify(data)}` : base;
  }

  info(message, data) {
    console.log(this._format("INFO", message, data));
  }

  warn(message, data) {
    console.warn(this._format("WARN", message, data));
  }

  error(message, data) {
    console.error(this._format("ERROR", message, data));
  }

  debug(message, data) {
    if (process.env.DEBUG) {
      console.debug(this._format("DEBUG", message, data));
    }
  }
}
