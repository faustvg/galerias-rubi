/**
 * periodos.test.js — Regresión del bug real: "Semana pasada" debe ser
 * SIEMPRE lunes-domingo (ISO 8601), sin importar qué día de la semana sea
 * "hoy". Ver el comentario de cabecera en periodos.js para la causa raíz.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { toISO, rangoSemanaDe, rangoSemanaActual, rangoSemanaPasada, rangoMesActual, rangoMesPasado, rangoAnterior } from './periodos'

afterEach(() => {
  vi.useRealTimers()
})

function fijarHoy(iso) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${iso}T12:00:00`))   // mediodía: lejos de cualquier borde de medianoche
}

describe('toISO', () => {
  it('formatea con los componentes LOCALES del Date, nunca via toISOString/UTC', () => {
    // Este es exactamente el caso que rompía antes: toISOString() en una
    // zona UTC+ recorta un día. Al construir con new Date(año, mes, día)
    // (constructor local) y leer de vuelta con getFullYear/getMonth/getDate
    // (también locales), toISO nunca debe cruzar por UTC.
    const d = new Date(2026, 7, 17)   // 17 ago 2026 (mes 0-indexado: 7 = agosto)
    expect(toISO(d)).toBe('2026-08-17')
  })

  it('rellena con ceros mes y día de un dígito', () => {
    expect(toISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('rangoSemanaDe — caso reportado del bug (jueves 30 ago 2026 es domingo)', () => {
  // El brief original reportó: "hoy" = domingo 30 ago 2026, "Semana pasada"
  // debía dar lunes 17 ago -- domingo 23 ago, pero la página mostraba
  // 16 ago -- 22 ago (un día corrido). Este es ese caso exacto.
  it('semana pasada desde un domingo da el lunes-domingo anterior completo', () => {
    fijarHoy('2026-08-30')   // domingo
    expect(rangoSemanaPasada()).toEqual({ desde: '2026-08-17', hasta: '2026-08-23' })
  })

  it('semana actual desde ese mismo domingo es la semana que está terminando', () => {
    fijarHoy('2026-08-30')
    expect(rangoSemanaActual()).toEqual({ desde: '2026-08-24', hasta: '2026-08-30' })
  })
})

describe('rangoSemanaPasada — los 7 días de la semana dan el mismo resultado', () => {
  // Sin importar en qué día de la semana esté "hoy", "semana pasada" debe
  // ser SIEMPRE el mismo rango lunes-domingo (17-23 ago), mientras "hoy"
  // caiga dentro de la semana actual (24-30 ago) o el día exacto después
  // (31 ago, ya semana siguiente pero "la pasada" sigue siendo 17-23... no,
  // ver el caso de abajo por separado). Aquí cubrimos lun 24 - dom 30.
  const diasDeEstaSemana = [
    ['2026-08-24', 'lunes'],
    ['2026-08-25', 'martes'],
    ['2026-08-26', 'miércoles'],
    ['2026-08-27', 'jueves'],
    ['2026-08-28', 'viernes'],
    ['2026-08-29', 'sábado'],
    ['2026-08-30', 'domingo'],
  ]

  for (const [iso, nombreDia] of diasDeEstaSemana) {
    it(`hoy = ${nombreDia} ${iso} → semana pasada = 17-23 ago`, () => {
      fijarHoy(iso)
      expect(rangoSemanaPasada()).toEqual({ desde: '2026-08-17', hasta: '2026-08-23' })
    })
  }

  it('el lunes siguiente (31 ago) ya considera "pasada" la semana 24-30', () => {
    fijarHoy('2026-08-31')   // lunes de la semana ISO siguiente
    expect(rangoSemanaPasada()).toEqual({ desde: '2026-08-24', hasta: '2026-08-30' })
  })
})

describe('rangoSemanaDe — cruce de mes y de año', () => {
  it('una semana que cruza fin de mes reparte los días correctamente', () => {
    // 30 sep 2026 es miércoles; su semana ISO es lun 28 sep -- dom 4 oct.
    expect(rangoSemanaDe(new Date(2026, 8, 30))).toEqual({ desde: '2026-09-28', hasta: '2026-10-04' })
  })

  it('una semana que cruza fin de año reparte los días correctamente', () => {
    // 1 ene 2026 es jueves; su semana ISO es lun 29 dic 2025 -- dom 4 ene 2026.
    expect(rangoSemanaDe(new Date(2026, 0, 1))).toEqual({ desde: '2025-12-29', hasta: '2026-01-04' })
  })
})

describe('rangoMesActual / rangoMesPasado — sanity (mismo módulo, misma causa raíz de toISO)', () => {
  it('mes actual cubre del día 1 al último día del mes', () => {
    fijarHoy('2026-08-15')
    expect(rangoMesActual()).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' })
  })

  it('mes pasado maneja el cruce de año (enero → diciembre anterior)', () => {
    fijarHoy('2026-01-10')
    expect(rangoMesPasado()).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' })
  })
})

describe('rangoAnterior — periodo de comparación de Histórico', () => {
  it('mes completo → mes calendario anterior completo (31 → 30 días)', () => {
    expect(rangoAnterior({ desde: '2026-10-01', hasta: '2026-10-31' }))
      .toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
  })

  it('mes completo en enero → diciembre del año anterior', () => {
    expect(rangoAnterior({ desde: '2026-01-01', hasta: '2026-01-31' }))
      .toEqual({ desde: '2025-12-01', hasta: '2025-12-31' })
  })

  it('marzo → febrero (28 días)', () => {
    expect(rangoAnterior({ desde: '2026-03-01', hasta: '2026-03-31' }))
      .toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
  })

  it('semana ISO → semana anterior, también cruzando de año', () => {
    expect(rangoAnterior({ desde: '2026-10-26', hasta: '2026-11-01' }))
      .toEqual({ desde: '2026-10-19', hasta: '2026-10-25' })
    expect(rangoAnterior({ desde: '2026-01-05', hasta: '2026-01-11' }))
      .toEqual({ desde: '2025-12-29', hasta: '2026-01-04' })
  })
})
