// payments.js
const express = require("express");
const Stripe = require("stripe");
const User = require("../models/User"); // User model import kiya
const router = express.Router();

router.post("/create-checkout-session", async (req, res) => {
  try {
    const stripe = Stripe(process.env.STRIPE_SECRET);
    if (!stripe) return res.status(500).json({ message: "Stripe not configured" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Voice of Law - $2 Access" },
          unit_amount: 200 // $2.00
        },
        quantity: 1
      }],
      success_url: process.env.CLIENT_URL + "/auth/login?payment_status=success", // Ab login page par redirect karega
      cancel_url: process.env.CLIENT_URL + "/pay?canceled=1",
      metadata: {
        userId: req.body.userId, // User ID ko metadata mein daal diya
      },
    });

    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Webhook for handling successful payments
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  const stripe = Stripe(process.env.STRIPE_SECRET);
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the checkout.session.completed event
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata.userId;

    try {
      if (userId) {
        // Find the user and mark them as paid
        const user = await User.findById(userId);
        if (user) {
          user.isPaid = true;
          await user.save();
          console.log(`User ${userId} marked as paid.`);
        }
      }
    } catch (error) {
      console.error("Error updating user payment status:", error);
      return res.status(500).json({ message: "Server error updating payment status." });
    }
  }

  res.json({ received: true });
});

module.exports = router;