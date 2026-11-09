import { MockPaymentService } from '../services/mockPayment.service.js';

export async function initiatePayment(req, res, next) {
  try {
    const { bookingId, guestAccessToken } = req.body;
    const sessionData = await MockPaymentService.initiatePayment({
      bookingId,
      user: req.user || null,
      guestAccessToken: guestAccessToken || null
    });

    res.status(200).json({
      success: true,
      message: 'Mock payment session initiated successfully',
      data: sessionData
    });
  } catch (error) {
    next(error);
  }
}

export async function simulatePayment(req, res, next) {
  try {
    const { paymentReference, outcome, failureReason } = req.body;
    const result = await MockPaymentService.simulatePaymentOutcome({
      paymentReference,
      outcome: outcome || 'SUCCESS',
      failureReason: failureReason || null
    });

    res.status(200).json({
      success: result.success,
      message: result.success ? 'Payment simulated successfully' : 'Payment simulation failed',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function handleWebhook(req, res, next) {
  try {
    const signature = req.headers['x-mock-signature'];
    const result = await MockPaymentService.processWebhookEvent(req.body, signature);

    res.status(200).json({
      success: true,
      message: 'Webhook event processed',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function getPaymentStatus(req, res, next) {
  try {
    const transaction = await MockPaymentService.getPaymentStatus(req.params.paymentReference);
    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    next(error);
  }
}

export async function processRefund(req, res, next) {
  try {
    const { paymentReference, amountPaise, reason, guestAccessToken, idempotencyKey, simulateFailure } = req.body;
    const headerIdempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    const effectiveIdempotencyKey = idempotencyKey || headerIdempotencyKey || null;

    const result = await MockPaymentService.processRefund({
      paymentReference,
      amountPaise,
      reason,
      guestAccessToken,
      idempotencyKey: effectiveIdempotencyKey,
      user: req.user || null,
      simulateFailure: Boolean(simulateFailure)
    });

    res.status(200).json({
      success: result.success,
      message: result.message || 'Refund processed successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
}
