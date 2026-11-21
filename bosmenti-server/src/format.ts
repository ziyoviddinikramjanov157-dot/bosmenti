/** 1890000 -> "1 890 000 so‘m" */
export const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`
