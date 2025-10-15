import { createBrowserRouter } from 'react-router-dom';
import type{ RouteObject } from 'react-router-dom';
import Layout from '../components/layout/Layout';
import Home from '../pages/Home';
import PortScanner from '../pages/tools/PortScanner';
import ServiceDetection from '../pages/tools/ServiceDetection';
import OSFingerprint from '../pages/tools/OSFingerprint';
import SubdomainEnum from '../pages/tools/SubdomainEnum';
import Whois from '../pages/tools/Whois';
import DNSRecon from '../pages/tools/DNSRecon';
import ReverseIP from '../pages/tools/ReverseIP';
import IPGeolocation from '../pages/tools/IPGeolocation';
import DirFuzzer from '../pages/tools/DirFuzzer';
import VulnFuzzer from '../pages/tools/VulnFuzzer';
import APIScanner from '../pages/tools/APIScanner';
import BrokenAuth from '../pages/tools/BrokenAuth';
import BucketFinder from '../pages/cloud/BucketFinder';
import ContainerScanner from '../pages/cloud/ContainerScanner';
import K8sEnum from '../pages/cloud/K8sEnum';
import HashTool from '../pages/crypto/HashTool';
import CipherTool from '../pages/crypto/CipherTool';
import RSATool from '../pages/crypto/RSATool';
import JWTDecoder from '../pages/crypto/JWTDecoder';
import ImageStego from '../pages/stego/ImageStego';
import AudioStego from '../pages/stego/AudioStego';
import StegoExtract from '../pages/stego/StegoExtract';
import ImageMeta from '../pages/stego/ImageMeta';
import EmailBreachChecker from '../pages/intel/EmailBreachChecker';
import GoogleDork from '../pages/intel/GoogleDork';
import PacketAnalyzer from '@/pages/misc/PacketAnalyzer';
import HoneypotDashboard from '@/pages/honeypot/HoneypotDashboard';

const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />, 
    children: [
      { index: true, element: <Home /> },
      { path: 'tools/port-scanner', element: <PortScanner /> },
      { path: 'tools/service-detect', element: <ServiceDetection /> },
      { path: 'tools/os-fingerprint', element: <OSFingerprint /> },
      { path: 'tools/subdomains', element: <SubdomainEnum /> },
      { path: 'tools/whois', element: <Whois /> },
      { path: 'tools/dns-recon', element: <DNSRecon /> },
      { path: 'tools/reverse-ip', element: <ReverseIP /> },
      { path: 'tools/ip-geo', element: <IPGeolocation /> },
      { path: 'tools/dir-fuzzer', element: <DirFuzzer /> },
      { path: 'tools/vuln-fuzzer', element: <VulnFuzzer /> },
      { path: 'tools/api-scanner', element: <APIScanner /> },
      { path: 'tools/broken-auth', element: <BrokenAuth /> },
      { path: 'tools/s3-finder', element: <BucketFinder /> },
      { path: 'tools/container-scan', element: <ContainerScanner /> },
      { path: 'tools/k8s-enum', element: <K8sEnum /> },
      { path: 'tools/hash-cracker', element: <HashTool /> },
      { path: 'tools/ciphers', element: <CipherTool /> },
      { path: 'tools/rsa-aes', element: <RSATool /> },
      { path: 'tools/jwt', element: <JWTDecoder /> },
      { path: 'tools/stego-image', element: <ImageStego /> },
      { path: 'tools/stego-audio', element: <AudioStego /> },
      { path: 'tools/stego-extract', element: <StegoExtract /> },
      { path: 'tools/image-exif', element: <ImageMeta /> },
      { path: 'tools/breach-check', element: <EmailBreachChecker /> },
      { path: 'tools/google-dorks', element: <GoogleDork /> },
      { path: 'tools/packet-analyzer', element: <PacketAnalyzer /> },
      { path: '/honeypot', element: <HoneypotDashboard /> },
    ],
  },
];

export const router = createBrowserRouter(routes);