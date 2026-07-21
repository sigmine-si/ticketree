import type { NextConfig } from 'next'

const config: NextConfig = {
  // shared는 소스(.ts)를 그대로 export한다 — Next가 트랜스파일하게 한다
  transpilePackages: ['@ticketree/shared'],
  serverExternalPackages: ['pg'],
}

export default config
