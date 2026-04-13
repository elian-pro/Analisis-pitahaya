FROM nginx:alpine

COPY index.html /usr/share/nginx/html/index.html
COPY "Logo Zebra Blanco.png" /usr/share/nginx/html/Logo%20Zebra%20Blanco.png

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
