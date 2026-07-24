# Card scan Edge Function

This function performs real image analysis through the OpenAI Responses API. It
never exposes the provider key to the browser and does not return simulated
results when configuration is missing.

Deploy and configure it for the current Supabase project:

```sh
npx supabase login
npx supabase link --project-ref tolmxmyzvcjjfosjqfze
npx supabase secrets set OPENAI_API_KEY=your-server-side-key
npx supabase functions deploy card-scan --no-verify-jwt
```

Optional model override:

```sh
supabase secrets set OPENAI_CARD_SCAN_MODEL=gpt-4.1-mini
```

The app calls the deployed function with `supabase.functions.invoke("card-scan")`.
If the function or secret is missing, the scanner keeps the image and shows the
configuration/backend error so the user can retry or enter the inventory data
manually.

`verify_jwt` is disabled because the current PWA uses the Supabase publishable
key without a signed-in user session. The function does not accept privileged
database operations or service-role credentials; it validates image type/size,
limits requests per client on a best-effort basis, and keeps the provider key
server-side. The only required secret is `OPENAI_API_KEY`.
