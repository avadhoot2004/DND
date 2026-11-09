import mongoose from 'mongoose';
import { Station } from '../models/station.model.js';
import { StationStatus } from '../constants/index.js';

export class StationService {
  /**
   * List all stations with optional filters
   */
  static async getAllStations(filters = {}) {
    const query = {};

    if (filters.type) {
      query.type = filters.type;
    }

    if (filters.status) {
      query.status = filters.status;
    } else if (!filters.includeDeactivated) {
      // Exclude deactivated stations by default for public browsing
      query.status = { $ne: StationStatus.DEACTIVATED };
    }

    return Station.find(query).sort({ identifier: 1 }).lean();
  }

  /**
   * Get a single station by its MongoDB ObjectId or unique identifier (e.g., PC-01)
   */
  static async getStationById(idOrIdentifier) {
    let query;
    if (mongoose.Types.ObjectId.isValid(idOrIdentifier)) {
      query = { _id: idOrIdentifier };
    } else {
      query = { identifier: idOrIdentifier.toUpperCase() };
    }

    return Station.findOne(query).lean();
  }

  /**
   * Create a new station (Admin only)
   */
  static async createStation(data) {
    const existing = await Station.findOne({ identifier: data.identifier });
    if (existing) {
      const error = new Error(`Station with identifier '${data.identifier}' already exists`);
      error.statusCode = 409;
      error.code = 'STATION_IDENTIFIER_EXISTS';
      throw error;
    }

    const station = await Station.create(data);
    return station.toJSON();
  }

  /**
   * Update station details (Admin only)
   */
  static async updateStation(id, updateData) {
    const station = await Station.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true
    }).lean();

    if (!station) {
      const error = new Error('Station not found');
      error.statusCode = 404;
      error.code = 'STATION_NOT_FOUND';
      throw error;
    }

    return station;
  }

  /**
   * Soft deactivate a station (Admin only)
   */
  static async deactivateStation(id) {
    return this.updateStation(id, { status: StationStatus.DEACTIVATED });
  }
}
