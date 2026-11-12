import { fireEvent } from '@testing-library/react'

/**
 * Drive a <video> in jsdom (which has no playback): its time, length, speed and seeking are
 * plain values the test moves, firing the same events a browser would.
 */
export function fakeMedia(video: HTMLVideoElement, duration = 100) {
  let time = 0
  let rate = 1
  let seeking = false
  Object.defineProperties(video, {
    duration: { configurable: true, get: () => duration },
    currentTime: {
      configurable: true,
      get: () => time,
      set: (value: number) => {
        time = value
      },
    },
    playbackRate: {
      configurable: true,
      get: () => rate,
      set: (value: number) => {
        rate = value
      },
    },
    seeking: { configurable: true, get: () => seeking },
  })
  return {
    get time() {
      return time
    },
    get rate() {
      return rate
    },
    loaded() {
      fireEvent.loadedMetadata(video)
    },
    /** Normal playback up to `to` seconds. */
    playTo(to: number) {
      time = to
      fireEvent.timeUpdate(video)
    },
    /** The person drags the scrubber to `to`. */
    seek(to: number) {
      seeking = true
      time = to
      fireEvent.seeking(video)
      seeking = false
      fireEvent.timeUpdate(video)
    },
    setRate(value: number) {
      rate = value
      fireEvent.rateChange(video)
    },
    pause() {
      fireEvent.pause(video)
    },
    end() {
      time = duration
      fireEvent.ended(video)
    },
  }
}
