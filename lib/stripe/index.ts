import Stripe from "stripe";

export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY_LIVE ?? process.env.STRIPE_SECRET_KEY ?? "",
  {
    apiVersion: "2022-08-01",
    appInfo: {
      name: "Dub.sh",
      version: "0.1.0",
    },
  },
);
