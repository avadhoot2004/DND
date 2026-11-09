import { BookingEngineService } from '../services/bookingEngine.service.js';

export async function getAvailability(req, res, next) {
  try {
    const data = await BookingEngineService.getAvailability(req.query);
    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}
