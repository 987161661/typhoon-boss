"""Decode ECMWF open-data tropical-cyclone BUFR into compact JSON.

Requires the official ECMWF ecCodes Python package. The server installs it into
.runtime/python-packages on first use, so it does not become a Node dependency.
"""

import json
import math
import sys
from datetime import datetime, timezone, timedelta

from eccodes import (
    CODES_MISSING_DOUBLE,
    CODES_MISSING_LONG,
    CodesInternalError,
    codes_bufr_new_from_file,
    codes_get,
    codes_get_array,
    codes_release,
    codes_set,
)


def usable(value):
    return isinstance(value, (int, float)) and math.isfinite(value) and value not in (CODES_MISSING_DOUBLE, CODES_MISSING_LONG)


def at(values, index):
    if len(values) == 1:
        return values[0]
    return values[index] if index < len(values) else CODES_MISSING_DOUBLE


def first_usable(values, default=0):
    return next((int(value) for value in values if usable(value)), default)


def decode(path):
    storms = []
    with open(path, "rb") as stream:
        while True:
            handle = codes_bufr_new_from_file(stream)
            if handle is None:
                break
            try:
                codes_set(handle, "unpack", 1)
                storm_id = str(codes_get(handle, "stormIdentifier")).strip()
                base = datetime(
                    int(codes_get(handle, "year")), int(codes_get(handle, "month")), int(codes_get(handle, "day")),
                    int(codes_get(handle, "hour")), int(codes_get(handle, "minute")), tzinfo=timezone.utc
                )
                members = [int(value) for value in codes_get_array(handle, "ensembleMemberNumber")]
                tracks = {member: [] for member in members}
                analysis_lat = codes_get_array(handle, "#2#latitude")
                analysis_lon = codes_get_array(handle, "#2#longitude")
                analysis_pressure = codes_get_array(handle, "#1#pressureReducedToMeanSeaLevel")
                for index, member in enumerate(members):
                    lat, lon, pressure = at(analysis_lat, index), at(analysis_lon, index), at(analysis_pressure, index)
                    if usable(lat) and usable(lon):
                        tracks[member].append({"stepHours": 0, "time": base.isoformat().replace("+00:00", "Z"), "lat": lat, "lon": lon, "pressurePa": pressure if usable(pressure) else None})

                periods = 0
                while True:
                    periods += 1
                    try:
                        codes_get_array(handle, f"#{periods}#timePeriod")
                    except CodesInternalError:
                        break
                for period_rank in range(1, periods):
                    step = first_usable(codes_get_array(handle, f"#{period_rank}#timePeriod"))
                    position_rank = period_rank * 2 + 2
                    latitudes = codes_get_array(handle, f"#{position_rank}#latitude")
                    longitudes = codes_get_array(handle, f"#{position_rank}#longitude")
                    pressures = codes_get_array(handle, f"#{period_rank + 1}#pressureReducedToMeanSeaLevel")
                    valid_at = (base + timedelta(hours=step)).isoformat().replace("+00:00", "Z")
                    for index, member in enumerate(members):
                        lat, lon, pressure = at(latitudes, index), at(longitudes, index), at(pressures, index)
                        if usable(lat) and usable(lon):
                            tracks[member].append({"stepHours": step, "time": valid_at, "lat": lat, "lon": lon, "pressurePa": pressure if usable(pressure) else None})

                valid_tracks = [{"member": member, "points": points} for member, points in tracks.items() if points]
                if valid_tracks:
                    storms.append({"stormIdentifier": storm_id, "baseTime": base.isoformat().replace("+00:00", "Z"), "members": valid_tracks})
            finally:
                codes_release(handle)
    return {"storms": storms}


if __name__ == "__main__":
    try:
        print(json.dumps(decode(sys.argv[1]), ensure_ascii=False, separators=(",", ":")))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise
