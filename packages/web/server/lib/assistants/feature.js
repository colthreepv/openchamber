/** Server-wide identity switch. Browser navigation overrides only affect layout. */
export const assistantsEnabled = (env = process.env) => env.OPENCHAMBER_ASSISTANTS_ENABLED !== 'false';
