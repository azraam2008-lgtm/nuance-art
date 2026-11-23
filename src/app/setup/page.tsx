import { redirect } from 'next/navigation';

/** Eski "ilk kurulum" adresi: artık herkes kendi hesabını /signup sayfasından açar */
export default function SetupPage() {
  redirect('/signup');
}
