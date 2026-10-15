export function isLocalEvaluationHost():boolean {
  const host=location.hostname;
  return host==='localhost' || host==='127.0.0.1' || /^192\.168\./.test(host) || /^10\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}
