export default function handler(req, res) {
  // Safe endpoint: does NOT return secret values, only presence flags
  const hasAppPassword = !!process.env.APP_PASSWORD;
  const hasOuraKey = !!process.env.OURA_KEY;

  res.status(200).json({ appPassword: hasAppPassword, ouraKey: hasOuraKey });
}
