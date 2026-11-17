import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:5001/api';

export const options = {
    stages: [
        { duration: '10s', target: 25 },
        { duration: '20s', target: 50 },
        { duration: '10s', target: 0 },
    ],
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<2000'],
    },
};

export default function () {
    const health = http.get(`${BASE}/health`);
    check(health, {
        'health 200': (r) => r.status === 200,
    });

    const stations = http.get(`${BASE}/stations`);
    check(stations, {
        'stations 200': (r) => r.status === 200,
    });

    const stationList = stations.json('data') || [];

    check(stationList, {
        'at least 1 station': (s) => s.length > 0,
    });

    if (stationList.length === 0) {
        console.error('No stations returned');
        return;
    }

    // Distribute VUs across the available stations.
    const stationIndex = (__VU - 1) % stationList.length;
    const stationId = stationList[stationIndex]._id;

    // VUs sharing a station receive separate time windows.
    const stationLane = Math.floor(
        (__VU - 1) / stationList.length
    );

    const start = new Date();
    start.setDate(start.getDate() + 45);
    start.setHours(10, 0, 0, 0);

    const offsetMinutes = (stationLane * 60 + __ITER) * 60;
    start.setMinutes(start.getMinutes() + offsetMinutes);

    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const holdRes = http.post(
        `${BASE}/bookings/hold`,
        JSON.stringify({
            stationId,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            isGuest: true,
            guestInfo: {
                fullName: `k6 Guest ${__VU}-${__ITER}`,
                email: `k6-${__VU}-${__ITER}@example.com`,
                phone: '9876543210',
            },
        }),
        {
            headers: {
                'Content-Type': 'application/json',
            },
        }
    );

    check(holdRes, {
        'hold 201': (r) => r.status === 201,
        'hold not conflict': (r) => r.status !== 409,
        'hold returns booking': (r) =>
            r.json('data.booking') !== undefined,
    });

    sleep(1);
}