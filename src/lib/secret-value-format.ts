export type SecretValueFormat = 'text' | 'base64' | 'hex64';
export function parseSecretValueFormat(value: unknown): SecretValueFormat | undefined {
  if (value === undefined) return undefined;
  if (value !== 'text' && value !== 'base64' && value !== 'hex64') throw Error('Invalid secret value format.');
  return value;
}
export function secretValueFormatLabel(value?: SecretValueFormat): string {
  return value === 'hex64' ? 'Hex (64 characters)' : value === 'base64' ? 'Base64' : value === 'text' ? 'Plain text' : 'Not specified';
}
