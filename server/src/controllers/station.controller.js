import { StationService } from '../services/station.service.js';

export async function listStations(req, res, next) {
  try {
    const stations = await StationService.getAllStations(req.query);
    res.status(200).json({
      success: true,
      count: stations.length,
      data: stations
    });
  } catch (error) {
    next(error);
  }
}

export async function getStation(req, res, next) {
  try {
    const station = await StationService.getStationById(req.params.id);
    if (!station) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'STATION_NOT_FOUND',
          message: `Station '${req.params.id}' was not found`
        }
      });
    }

    res.status(200).json({
      success: true,
      data: station
    });
  } catch (error) {
    next(error);
  }
}

export async function createStation(req, res, next) {
  try {
    const station = await StationService.createStation(req.body);
    res.status(201).json({
      success: true,
      message: 'Station created successfully',
      data: station
    });
  } catch (error) {
    next(error);
  }
}

export async function updateStation(req, res, next) {
  try {
    const station = await StationService.updateStation(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Station updated successfully',
      data: station
    });
  } catch (error) {
    next(error);
  }
}

export async function deactivateStation(req, res, next) {
  try {
    const station = await StationService.deactivateStation(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Station deactivated successfully',
      data: station
    });
  } catch (error) {
    next(error);
  }
}

