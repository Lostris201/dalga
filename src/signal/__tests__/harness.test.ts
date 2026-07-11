test('jest harness runs TypeScript under src/', () => {
  const add = (a: number, b: number): number => a + b;
  expect(add(2, 3)).toBe(5);
});
