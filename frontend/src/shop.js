// Everything customers see about the shop, in one place: change it here to
// rename or move the shop. The backend has its own copy for the emails:
// SHOP_NAME and SHOP_ADDRESS (backend/.env locally, render.yaml in production).
export const SHOP = {
  name: 'North Street Studio', // full name: headings, browser tab, address card
  shortName: 'North Street', // top bar and booking card
  initials: 'NS', // the round logo
  street: '27 North Street',
  city: 'Gothenburg',
  phone: '+46 70 123 45 67',
  hours: 'Tue–Sat · 09:00–18:00',
}

export const SHOP_ADDRESS = `${SHOP.street}, ${SHOP.city}`
export const SHOP_PHONE_LINK = `tel:${SHOP.phone.replace(/[^\d+]/g, '')}` // "tel:+46701234567"
